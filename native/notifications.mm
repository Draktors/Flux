// Reads and requests the macOS notification permission of the running app.
// Electron sends notifications through UNUserNotificationCenter but exposes neither call.
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

#define NAPI_VERSION 8
#include <node_api.h>

#include <cstdio>
#include <cstring>

namespace {

struct Job {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  bool request = false;
  const char *status = "unsupported";
  char error[512] = {0};
};

const char *StatusName(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusNotDetermined:
      return "not-determined";
    case UNAuthorizationStatusDenied:
      return "denied";
    case UNAuthorizationStatusAuthorized:
      return "authorized";
    case UNAuthorizationStatusProvisional:
      return "provisional";
    default:
      return "authorized";
  }
}

// Runs on a libuv worker: the completion handlers fire on another queue, so waiting here is safe,
// and a pending permission prompt only holds this worker, never the main thread.
void Execute(napi_env, void *data) {
  Job *job = static_cast<Job *>(data);
  @try {
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    void (^readStatus)(void) = ^{
      [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        job->status = StatusName(settings.authorizationStatus);
        dispatch_semaphore_signal(done);
      }];
    };
    if (job->request) {
      UNAuthorizationOptions options =
          UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
      [center requestAuthorizationWithOptions:options
                            completionHandler:^(BOOL, NSError *error) {
                              if (error) {
                                snprintf(job->error, sizeof(job->error), "%s",
                                         error.localizedDescription.UTF8String);
                              }
                              readStatus();
                            }];
    } else {
      readStatus();
    }
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  } @catch (NSException *exception) {
    job->status = "unsupported";
    snprintf(job->error, sizeof(job->error), "%s", exception.reason.UTF8String);
  }
}

void Complete(napi_env env, napi_status, void *data) {
  Job *job = static_cast<Job *>(data);
  napi_value result, status, error;
  napi_create_object(env, &result);
  napi_create_string_utf8(env, job->status, NAPI_AUTO_LENGTH, &status);
  napi_set_named_property(env, result, "status", status);
  if (job->error[0]) {
    napi_create_string_utf8(env, job->error, NAPI_AUTO_LENGTH, &error);
    napi_set_named_property(env, result, "error", error);
  }
  napi_resolve_deferred(env, job->deferred, result);
  napi_delete_async_work(env, job->work);
  delete job;
}

napi_value Start(napi_env env, bool request) {
  Job *job = new Job();
  job->request = request;
  napi_value promise, name;
  napi_create_promise(env, &job->deferred, &promise);
  napi_create_string_utf8(env, "flux-notification-access", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, Execute, Complete, job, &job->work);
  napi_queue_async_work(env, job->work);
  return promise;
}

napi_value Status(napi_env env, napi_callback_info) { return Start(env, false); }
napi_value Request(napi_env env, napi_callback_info) { return Start(env, true); }

napi_value Init(napi_env env, napi_value exports) {
  napi_value status, request;
  napi_create_function(env, "status", NAPI_AUTO_LENGTH, Status, nullptr, &status);
  napi_create_function(env, "request", NAPI_AUTO_LENGTH, Request, nullptr, &request);
  napi_set_named_property(env, exports, "status", status);
  napi_set_named_property(env, exports, "request", request);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
