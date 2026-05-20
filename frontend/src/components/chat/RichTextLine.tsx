import React from "react";
import { tokenizeInlineCode } from "../../utils/messageUtils";

export function RichTextLine({ text }: { text: string }) {
  const tokens = tokenizeInlineCode(text);

  return (
    <>
      {tokens.map((token, index) =>
        token.type === "code" ? (
          <code key={`${token.type}-${index}`}>{token.value}</code>
        ) : (
          <span key={`${token.type}-${index}`}>{token.value}</span>
        )
      )}
    </>
  );
}
