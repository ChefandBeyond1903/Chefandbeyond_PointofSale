import { NextRequest, NextResponse } from "next/server";
import { requireScopedUser } from "@/lib/scope";
import { toErrorResponse } from "@/lib/api";
import { loadSaleForPdf, renderSalePdf, pdfFilename } from "@/lib/invoiceEmail";

type Params = { params: Promise<{ id: string }> };

/** The invoice/receipt as a PDF — what the "Email invoice" button attaches. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const { sale, company } = await loadSaleForPdf(id, actor);
    const pdf = await renderSalePdf(sale, company);
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdfFilename(sale)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
