import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LinkIcon } from './Brand'

export function Prose({ source, className = 'prose' }: { source: string; className?: string }) {
  return (
    <article className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                if (href) void window.flux.openExternal(href)
              }}
            >
              <LinkIcon url={href} size={13} />
              {children}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
    </article>
  )
}
