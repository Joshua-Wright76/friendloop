/**
 * A heading's numbers in the body face. Gaegu draws a 1 like an I and a 0 like an O,
 * so "Round 12" reads as "Round I2"; the words keep the handwriting, the digits don't.
 */
export function DisplayDigits({ children }: { children: string }) {
  return (
    <>
      {children.split(/(\d+)/).map((part, index) =>
        /^\d+$/.test(part) ? <span key={index} className="display-digits">{part}</span> : part,
      )}
    </>
  );
}
