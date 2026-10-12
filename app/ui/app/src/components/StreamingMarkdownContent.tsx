import React from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import remarkCitationParser from "@/utils/remarkCitationParser";
import CopyButton from "./CopyButton";
import type { BundledLanguage } from "shiki";
import { highlighter } from "@/lib/highlighter";

/**
 * Colors migrated to the 8-token contract (surface / fg / border …): code
 * blocks, tables, inline code, citation chips, and prose body/headings/
 * strong/markers now all follow the active [data-theme].
 *
 * Kept deliberately:
 *   - dark:hidden / hidden dark:block on the twin <pre>s — these are
 *     STRUCTURAL (they pick which pre renders, light or dark). The dark:
 *     variant already keys off data-theme-scheme since Batch 3, so this
 *     split follows every theme's scheme correctly.
 *   - Shiki one-light / one-dark syntax token colors are inline styles
 *     keyed to the SCHEME, not the theme: readable on every surface, but
 *     the syntax palette itself doesn't shift per-theme (separate feature
 *     if wanted later).
 *   - `dark:` pairs on tokens were dropped where the token auto-flips
 *     (e.g. dark:border-neutral-700 next to border-border is redundant —
 *     --color-border flips itself).
 */

// Helper to extract text from React nodes
const extractText = (node: React.ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (React.isValidElement(node)) {
    const props = node.props as any;
    if (props?.children) {
      return extractText(props.children as React.ReactNode);
    }
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  return "";
};

const CodeBlock = React.memo(
  ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
    // Extract code and language from children
    const codeElement = children as React.ReactElement<{
      className?: string;
      children: React.ReactNode;
    }>;
    const language =
      codeElement.props.className?.replace(/language-/, "") || "";
    const codeText = extractText(codeElement.props.children);

    // Synchronously highlight code using the pre-loaded highlighter
    const tokens = React.useMemo(() => {
      if (!highlighter) return null;

      try {
        return {
          light: highlighter.codeToTokensBase(codeText, {
            lang: language as BundledLanguage,
            theme: "one-light" as any,
          }),
          dark: highlighter.codeToTokensBase(codeText, {
            lang: language as BundledLanguage,
            theme: "one-dark" as any,
          }),
        };
      } catch (error) {
        console.error("Failed to highlight code:", error);
        return null;
      }
    }, [codeText, language]);

    return (
      <div className="relative bg-surface-raised rounded-2xl overflow-hidden my-6">
        <div className="flex select-none">
          {language && (
            <div className="text-[13px] text-fg-muted font-mono px-4 py-2">
              {language}
            </div>
          )}
          <CopyButton
            content={codeText}
            showLabels={true}
            className="copy-button text-fg-muted bg-surface-raised ml-auto"
          />
        </div>
        {/* Light mode */}
        <pre className="dark:hidden m-0 bg-surface-raised text-sm overflow-x-auto p-4">
          <code className="font-mono text-sm">
            {tokens?.light
              ? tokens.light.map((line: any, i: number) => (
                  <React.Fragment key={i}>
                    {line.map((token: any, j: number) => (
                      <span
                        key={j}
                        style={{
                          color: token.color,
                        }}
                      >
                        {token.content}
                      </span>
                    ))}
                    {i < tokens.light.length - 1 && "\n"}
                  </React.Fragment>
                ))
              : codeText}
          </code>
        </pre>
        {/* Dark mode */}
        <pre className="hidden dark:block m-0 bg-surface-raised text-sm overflow-x-auto p-4">
          <code className="font-mono text-sm">
            {tokens?.dark
              ? tokens.dark.map((line: any, i: number) => (
                  <React.Fragment key={i}>
                    {line.map((token: any, j: number) => (
                      <span
                        key={j}
                        style={{
                          color: token.color,
                        }}
                      >
                        {token.content}
                      </span>
                    ))}
                    {i < tokens.dark.length - 1 && "\n"}
                  </React.Fragment>
                ))
              : codeText}
          </code>
        </pre>
      </div>
    );
  },
);

interface StreamingMarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  size?: "sm" | "md" | "lg";
  browserToolResult?: {
    page_stack: string[];
  };
}

const StreamingMarkdownContent: React.FC<StreamingMarkdownContentProps> =
  React.memo(({ content, isStreaming = false, size, browserToolResult }) => {
    // Build the remark plugins array - keep default GFM and Math, add citations
    const remarkPlugins = React.useMemo(() => {
      return [
        defaultRemarkPlugins.gfm,
        defaultRemarkPlugins.math,
        remarkCitationParser,
      ];
    }, []);

    return (
      <div
        className={`
          max-w-full
          ${size === "sm" ? "prose-sm" : size === "lg" ? "prose-lg" : ""}
          prose
          prose-neutral
          prose-headings:font-semibold
          prose:text-fg
          prose-strong:font-semibold
          prose-strong:text-fg
          prose-ul:marker:text-fg
          prose-li:marker:text-fg
          prose-headings:text-fg
          prose-pre:bg-transparent
          prose-pre:rounded-xl
          prose-pre:text-fg
          prose-pre:font-normal
          prose-pre:my-0
          prose-pre:max-w-full
          prose-pre:pt-1
          [&_table]:border-collapse
          [&_table]:w-full
          [&_table]:border
          [&_table]:border-border
          [&_table]:rounded-lg
          [&_table]:overflow-hidden
          [&_th]:px-3
          [&_th]:py-2
          [&_th]:text-left
          [&_th]:font-semibold
          [&_th]:border-b
          [&_th]:border-r
          [&_th]:border-border
          [&_th:last-child]:border-r-0
          [&_td]:px-3
          [&_td]:py-2
          [&_td]:border-r
          [&_td]:border-border
          [&_td:last-child]:border-r-0
          [&_tbody_tr:not(:last-child)_td]:border-b
          [&_code:not(pre_code)]:text-fg
          [&_code:not(pre_code)]:bg-surface-raised
          [&_code:not(pre_code)]:font-normal
          [&_code:not(pre_code)]:px-1.5
          [&_code:not(pre_code)]:py-0.5
          [&_code:not(pre_code)]:rounded-md
          [&_code:not(pre_code)]:text-[90%]
          [&_code:not(pre_code)]:before:hidden
          [&_code:not(pre_code)]:after:hidden
          dark:prose-invert
          dark:prose-pre:bg-none
          dark:[&_thead]:bg-surface-raised
          break-words
        `}
      >
        <StreamingMarkdownErrorBoundary
          content={content}
          isStreaming={isStreaming}
        >
          <Streamdown
            parseIncompleteMarkdown={isStreaming}
            isAnimating={isStreaming}
            remarkPlugins={remarkPlugins}
            controls={false}
            components={{
              pre: CodeBlock,
              table: ({
                children,
                ...props
              }: React.HTMLAttributes<HTMLTableElement>) => (
                <div className="overflow-x-auto max-w-full">
                  <table
                    {...props}
                    className="border-collapse w-full border border-border rounded-lg overflow-hidden"
                  >
                    {children}
                  </table>
                </div>
              ),
              // @ts-expect-error: custom citation type
              "ol-citation": ({
                cursor,
              }: {
                cursor: number;
                start: number;
                end: number;
              }) => {
                const pageStack = browserToolResult?.page_stack;
                const hasValidPage = pageStack && cursor < pageStack.length;
                const pageUrl = hasValidPage ? pageStack[cursor] : null;

                const getPageTitle = (url: string) => {
                  if (url.startsWith("search_results_")) {
                    const searchTerm = url.substring("search_results_".length);
                    return `Search: ${searchTerm}`;
                  }
                  try {
                    const urlObj = new URL(url);
                    return urlObj.hostname;
                  } catch {
                    return url;
                  }
                };

                const citationElement = (
                  <span className="text-xs text-fg-muted bg-surface-raised rounded-full px-2 py-1 ml-1">
                    [{cursor}]
                  </span>
                );

                if (pageUrl && pageUrl.startsWith("http")) {
                  return (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center hover:opacity-80 transition-opacity no-underline"
                      title={getPageTitle(pageUrl)}
                    >
                      {citationElement}
                    </a>
                  );
                }

                return citationElement;
              },
            }}
          >
            {content}
          </Streamdown>
        </StreamingMarkdownErrorBoundary>
      </div>
    );
  });

interface StreamingMarkdownErrorBoundaryProps {
  content: string;
  children: React.ReactNode;
  isStreaming: boolean;
}

// Sometimes remark will throw errors, particularly when rendering math. We add
// this fallback to show the plain text content if there's an error, and then we
// retry rendering the content if the content changes OR if we change our
// streaming state (because we render things differently when in streaming mode
// v. not, so for some cases we'll automatically recover once streaming is over)
//
// This should not be relied on for anything known to be broken (any known
// errors should be fixed!), but it's necessary to not break the full UI because
// of some bad markdown
class StreamingMarkdownErrorBoundary extends React.Component<
  StreamingMarkdownErrorBoundaryProps,
  { hasError: boolean }
> {
  constructor(props: StreamingMarkdownErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidUpdate(prevProps: StreamingMarkdownErrorBoundaryProps) {
    if (
      prevProps.isStreaming !== this.props.isStreaming ||
      prevProps.content !== this.props.content
    ) {
      this.setState({ hasError: false });
    }
  }

  static getDerivedStateFromError(/*_error: Error*/) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      "StreamingMarkdownContent: caught rendering error",
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) {
      // TODO(drifkin): render this more nicely so it's not so jarring. For
      // example, probably want to render newlines, etc. But let's not get too
      // fancy because then we'll end up needing an ErrorBoundaryErrorBoundary
      // :upside_down_face:
      return <div>{this.props.content}</div>;
    }

    return this.props.children;
  }
}

export default StreamingMarkdownContent;