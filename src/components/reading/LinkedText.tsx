import { linkify } from "@/domain/readingActions";

/** A note's text with its web links (websites, YouTube...) made tappable. The words themselves are untouched. */
export function LinkedText({ text }: { text: string }) {
  return (
    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {linkify(text).map((piece, i) =>
        piece.kind === "link" ? (
          <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer">
            {piece.text}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </p>
  );
}
