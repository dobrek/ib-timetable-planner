import { Printer } from "lucide-react";
import { Button } from "./button";

type Props = {
  /** Title + aria-label override; defaults to "Print". */
  title?: string;
};

/**
 * A small, framework-free print affordance: triggers the browser's native print dialog
 * (Save-as-PDF or paper) and hides itself from the printout (`print:hidden`). Mirrors the
 * export button's ghost/icon presentation so it slots beside it in a page header. Stateless
 * and SSR-safe — `window` is touched only inside the click handler.
 */
export function PrintButton({ title = "Print" }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 print:hidden"
      title={title}
      aria-label={title}
      onClick={() => {
        window.print();
      }}
    >
      <Printer />
    </Button>
  );
}
