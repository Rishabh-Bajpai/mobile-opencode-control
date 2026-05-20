import React from "react";
import { RichTextLine } from "./RichTextLine";

export function RichMessageText({ text }: { text: string }) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const nodes: JSX.Element[] = [];
  const lines = normalized.split("\n");
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let codeFence: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    nodes.push(
      <p key={`paragraph-${nodes.length}`}>
        {paragraphLines.map((line, index) => (
          <span key={index}>
            {index > 0 ? <br /> : null}
            <RichTextLine text={line} />
          </span>
        ))}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>
            <RichTextLine text={item} />
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCodeFence = () => {
    if (codeFence.length === 0) {
      return;
    }
    nodes.push(
      <pre key={`code-${nodes.length}`} className="message-code-block">
        <code>{codeFence.join("\n")}</code>
      </pre>
    );
    codeFence = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeFence) {
        flushCodeFence();
      }
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      codeFence.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      const headingLevel = Math.min(4, trimmed.match(/^#+/)?.[0].length ?? 3);
      const HeadingTag = `h${headingLevel}` as keyof JSX.IntrinsicElements;
      nodes.push(
        <HeadingTag key={`heading-${nodes.length}`} className="message-heading">
          <RichTextLine text={trimmed.replace(/^#{1,3}\s+/, "")} />
        </HeadingTag>
      );
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCodeFence();

  return <div className="message-rich-text">{nodes}</div>;
}
