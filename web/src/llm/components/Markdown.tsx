// Renders the markdown token tree (llm/markdown.ts) to React elements. It emits
// only React nodes — never dangerouslySetInnerHTML — so untrusted model output
// cannot inject markup. Links open in a new tab with noreferrer.

import { Fragment, type ReactNode } from "react";

import { deLatex, parseBlocks, type Align, type Block, type Inline } from "../markdown";

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return <Fragment key={i}>{deLatex(n.value)}</Fragment>;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.children)}</em>;
      case "code":
        return (
          <code key={i} className="md-code">
            {n.value}
          </code>
        );
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">
            {renderInline(n.children)}
          </a>
        );
    }
  });
}

const alignStyle = (a: Align): React.CSSProperties | undefined =>
  a ? { textAlign: a } : undefined;

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const H = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      return (
        <H key={key} className="md-h">
          {renderInline(block.inline)}
        </H>
      );
    }
    case "paragraph":
      return <p key={key} className="md-p">{renderInline(block.inline)}</p>;
    case "code":
      return (
        <pre key={key} className="md-pre">
          <code>{block.value}</code>
        </pre>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} className="md-list">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.header.map((cell, c) => (
                  <th key={c} style={alignStyle(block.align[c] ?? null)}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={alignStyle(block.align[c] ?? null)}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="md-quote">
          {renderInline(block.inline)}
        </blockquote>
      );
    case "hr":
      return <hr key={key} className="md-hr" />;
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
