"use client";

import { PassageWorkspaceV3 } from "../../components/PassageWorkspaceV3";

export default function PassagePage() {
  return <>
    <style jsx global>{`
      .passage-print-control{display:none}
      body:has(.passage-navbrief-embed) .passage-print-control{display:inline-flex}
      @media print{.passage-print-control{display:none!important}}
    `}</style>
    <button
      type="button"
      onClick={() => window.print()}
      className="passage-print-control no-print fixed right-5 top-5 z-[90] border border-[#c9a227] bg-[#c9a227] px-4 py-2 text-[11px] font-black uppercase tracking-[.08em] text-black shadow-lg hover:bg-[#d6b63b]"
    >
      Print / PDF
    </button>
    <PassageWorkspaceV3 />
  </>;
}
