import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  table: ({ children, ...props }) => (
    <div className="table-wrapper" {...props}>
      <table>{children}</table>
    </div>
  ),
  pre: ({ children, ...props }) => (
    <div className="code-wrapper" {...props}>
      <pre>{children}</pre>
    </div>
  ),
};

export function RichMessageText({ text }: { text: string }) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  return (
    <div className="message-rich-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
