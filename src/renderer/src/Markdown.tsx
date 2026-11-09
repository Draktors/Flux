import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
