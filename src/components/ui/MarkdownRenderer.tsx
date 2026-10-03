import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: "default" | "drawer" | "chat-assistant" | "chat-user";
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
  variant = "default",
}) => {
  const isUser = variant === "chat-user";

  return (
    <div
      className={`markdown-content leading-relaxed break-words ${
        isUser ? "text-gray-950 font-medium" : "text-gray-800"
      } ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Bold text
          strong: ({ children }) => (
            <strong
              className={`font-black tracking-tight ${
                isUser ? "text-black font-black" : "text-gray-950 font-bold"
              }`}
            >
              {children}
            </strong>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed text-xs">
              {children}
            </p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-outside pl-4 space-y-1 my-2 text-xs">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside pl-4 space-y-1 my-2 text-xs">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li
              className={`leading-relaxed pl-0.5 ${
                isUser ? "marker:text-emerald-200" : "marker:text-emerald-600"
              }`}
            >
              {children}
            </li>
          ),

          // Headings
          h1: ({ children }) => (
            <h1 className="text-sm font-black text-gray-950 mt-3 mb-1.5 flex items-center gap-1.5">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xs font-black text-gray-900 mt-2.5 mb-1 flex items-center gap-1.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-black text-emerald-800 mt-2 mb-1">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[11px] font-extrabold text-gray-800 mt-1.5 mb-0.5">
              {children}
            </h4>
          ),

          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-2xl border border-gray-200/90 shadow-2xs bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-emerald-50/70 border-b border-gray-200">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-gray-100 bg-white">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-emerald-50/30 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-emerald-950 bg-emerald-50/90">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-[11px] text-gray-700 align-top leading-normal">
              {children}
            </td>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-emerald-500 bg-emerald-50/60 pl-3 py-1.5 my-2 rounded-r-xl text-emerald-900 text-[11px] italic font-medium">
              {children}
            </blockquote>
          ),

          // Code blocks & inline code
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                    isUser
                      ? "bg-emerald-800/80 text-emerald-100"
                      : "bg-gray-100 text-emerald-800 border border-gray-200"
                  }`}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="p-3 my-2 rounded-xl bg-gray-900 text-emerald-300 font-mono text-[11px] overflow-x-auto">
                <code>{children}</code>
              </pre>
            );
          },

          // Horizontal rule
          hr: () => <hr className="my-2.5 border-gray-200/80" />,

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 hover:text-emerald-700 underline font-bold"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
