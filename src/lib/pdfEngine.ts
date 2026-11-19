import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface ResolutionPdfDraft {
  referenceCode: string;
  companyName: string;
  companyUen?: string;
  jurisdiction?: string;
  category: string;
  title: string;
  statutoryDueDate: string;
  summary: string;
  bodyText: string;
  directorNames: string[];
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
        current = (current + ' ' + word).trim();
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Generates an executive-formatted Corporate Secretarial Resolution PDF using pdf-lib.
 */
export async function generateResolutionPdfBytes(
  draft: ResolutionPdfDraft
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 52;
  let y = height - 54;

  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const slate = rgb(71 / 255, 85 / 255, 105 / 255);
  const muted = rgb(100 / 255, 116 / 255, 139 / 255);
  const hairline = rgb(203 / 255, 213 / 255, 225 / 255);

  // Header band
  page.drawRectangle({
    x: 0,
    y: height - 104,
    width,
    height: 104,
    color: navy,
  });

  page.drawText(draft.companyName.toUpperCase().slice(0, 62), {
    x: margin,
    y: height - 46,
    size: 14,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  const metaLine = [
    draft.companyUen ? `UEN / Reg No: ${draft.companyUen}` : null,
    draft.jurisdiction || 'Incorporated under the Companies Act',
  ]
    .filter(Boolean)
    .join('   |   ');

  page.drawText(metaLine.slice(0, 90), {
    x: margin,
    y: height - 66,
    size: 9,
    font: helvetica,
    color: rgb(203 / 255, 213 / 255, 225 / 255),
  });

  page.drawText(`REF: ${draft.referenceCode}   |   DUE: ${draft.statutoryDueDate}`, {
    x: margin,
    y: height - 86,
    size: 8.5,
    font: courier,
    color: rgb(251 / 255, 191 / 255, 36 / 255),
  });

  y = height - 138;

  // Document classification
  page.drawText(draft.category.toUpperCase(), {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: muted,
  });
  y -= 20;

  // Title
  const titleLines = wrapText(draft.title, 60);
  for (const line of titleLines) {
    page.drawText(line, {
      x: margin,
      y,
      size: 15,
      font: helveticaBold,
      color: navy,
    });
    y -= 20;
  }

  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: hairline,
  });
  y -= 22;

  // Executive Summary
  page.drawText('EXECUTIVE SUMMARY', {
    x: margin,
    y,
    size: 8.5,
    font: helveticaBold,
    color: muted,
  });
  y -= 15;

  for (const line of wrapText(draft.summary, 84)) {
    page.drawText(line, {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: slate,
    });
    y -= 14;
  }

  y -= 12;
  page.drawText('DIRECTORS WRITTEN RESOLUTION', {
    x: margin,
    y,
    size: 8.5,
    font: helveticaBold,
    color: muted,
  });
  y -= 16;

  // Full Body Text
  const bodyLines = wrapText(draft.bodyText, 82);
  for (const line of bodyLines) {
    if (y < 180) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 64;
    }
    if (!line) {
      y -= 8;
      continue;
    }
    page.drawText(line, {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: navy,
    });
    y -= 14.5;
  }

  // Signature Execution Block
  if (y < 210) {
    page = pdfDoc.addPage([595.28, 841.89]);
    y = height - 72;
  } else {
    y -= 24;
  }

  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: hairline,
  });
  y -= 20;

  page.drawText('EXECUTION BY THE BOARD OF DIRECTORS', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: navy,
  });
  y -= 14;
  page.drawText(
    'This resolution may be executed in counterparts by electronic signature or wet-ink scan.',
    {
      x: margin,
      y,
      size: 8.5,
      font: helvetica,
      color: muted,
    }
  );
  y -= 28;

  const directors = draft.directorNames.length > 0 ? draft.directorNames : ['Authorised Director'];
  for (let i = 0; i < Math.min(directors.length, 4); i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const xPos = margin + col * 248;
    const yPos = y - row * 92;
    if (yPos < 60) break;

    page.drawRectangle({
      x: xPos,
      y: yPos - 54,
      width: 230,
      height: 58,
      borderColor: hairline,
      borderWidth: 0.75,
      color: rgb(248 / 255, 250 / 255, 252 / 255),
    });

    page.drawText(directors[i].slice(0, 32), {
      x: xPos + 8,
      y: yPos - 68,
      size: 9,
      font: helveticaBold,
      color: navy,
    });
    page.drawText('Director  |  Date: Pending', {
      x: xPos + 8,
      y: yPos - 80,
      size: 8,
      font: courier,
      color: muted,
    });
  }

  return pdfDoc.save();
}

export interface StampSignatureOptions {
  directorName: string;
  directorEmail: string;
  method: 'e-signature' | 'wet-ink-scan';
  signatureImageDataUrl: string;
  signedAtIso: string;
  slotIndex: number;
  referenceCode: string;
}

/**
 * Stamps a drawn PNG e-signature or wet-ink scan directly onto the PDF document
 * along with the director's name, verification timestamp, and execution audit line.
 */
export async function stampSignatureOnPdfBytes(
  existingPdfBytes: Uint8Array,
  options: StampSignatureOptions
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const emerald = rgb(5 / 255, 150 / 255, 105 / 255);
  const muted = rgb(100 / 255, 116 / 255, 139 / 255);
  const hairline = rgb(203 / 255, 213 / 255, 225 / 255);

  // Decode image bytes (PNG or JPEG)
  const isJpeg =
    options.signatureImageDataUrl.startsWith('data:image/jpeg') ||
    options.signatureImageDataUrl.startsWith('data:image/jpg');
  const rawBase64 = options.signatureImageDataUrl.includes(',')
    ? options.signatureImageDataUrl.split(',')[1]
    : options.signatureImageDataUrl;
  const imgBinary = atob(rawBase64);
  const imgBytes = new Uint8Array(imgBinary.length);
  for (let i = 0; i < imgBinary.length; i++) {
    imgBytes[i] = imgBinary.charCodeAt(i);
  }

  const embeddedImage = isJpeg
    ? await pdfDoc.embedJpg(imgBytes)
    : await pdfDoc.embedPng(imgBytes);

  // Add or reuse an Execution Audit & Signatures page so uploaded external PDFs are never obscured
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const needNewPage = options.slotIndex === 0 && pages.length >= 1;
  const targetPage = needNewPage ? pdfDoc.addPage([595.28, 841.89]) : lastPage;

  const { width, height } = targetPage.getSize();
  const margin = 52;

  if (needNewPage) {
    targetPage.drawRectangle({
      x: 0,
      y: height - 74,
      width,
      height: 74,
      color: navy,
    });
    targetPage.drawText('EXECUTION CERTIFICATE & DIRECTOR SIGNATURES', {
      x: margin,
      y: height - 36,
      size: 12,
      font: helveticaBold,
      color: rgb(1, 1, 1),
    });
    targetPage.drawText(`RESOLUTION REF: ${options.referenceCode}   |   QUORUMSEAL VERIFIED AUDIT TRAIL`, {
      x: margin,
      y: height - 56,
      size: 8.5,
      font: courier,
      color: rgb(203 / 255, 213 / 255, 225 / 255),
    });
  }

  const cardTopY = height - 110 - (options.slotIndex % 4) * 165;
  const cardHeight = 142;

  targetPage.drawRectangle({
    x: margin,
    y: cardTopY - cardHeight,
    width: width - margin * 2,
    height: cardHeight,
    borderColor: hairline,
    borderWidth: 1,
    color: rgb(255 / 255, 255 / 255, 255 / 255),
  });

  // Left signature visual box
  const sigBoxX = margin + 16;
  const sigBoxY = cardTopY - cardHeight + 18;
  const sigBoxW = 210;
  const sigBoxH = 104;

  targetPage.drawRectangle({
    x: sigBoxX,
    y: sigBoxY,
    width: sigBoxW,
    height: sigBoxH,
    color: rgb(248 / 255, 250 / 255, 252 / 255),
    borderColor: hairline,
    borderWidth: 0.5,
  });

  const dims = embeddedImage.scaleToFit(sigBoxW - 16, sigBoxH - 16);
  targetPage.drawImage(embeddedImage, {
    x: sigBoxX + (sigBoxW - dims.width) / 2,
    y: sigBoxY + (sigBoxH - dims.height) / 2,
    width: dims.width,
    height: dims.height,
  });

  // Right execution metadata
  const infoX = sigBoxX + sigBoxW + 22;
  const formattedDate = new Date(options.signedAtIso).toUTCString();

  targetPage.drawText('SIGNED & VERIFIED', {
    x: infoX,
    y: cardTopY - 30,
    size: 8.5,
    font: helveticaBold,
    color: emerald,
  });

  targetPage.drawText(options.directorName.slice(0, 38), {
    x: infoX,
    y: cardTopY - 52,
    size: 13,
    font: helveticaBold,
    color: navy,
  });

  targetPage.drawText(`Email: ${options.directorEmail.slice(0, 40)}`, {
    x: infoX,
    y: cardTopY - 72,
    size: 9,
    font: helvetica,
    color: muted,
  });

  targetPage.drawText(
    `Method: ${options.method === 'e-signature' ? 'In-App Touch E-Signature' : 'Wet-Ink Scan Upload'}`,
    {
      x: infoX,
      y: cardTopY - 90,
      size: 9,
      font: helvetica,
      color: navy,
    }
  );

  targetPage.drawText(`Date: ${formattedDate}`, {
    x: infoX,
    y: cardTopY - 108,
    size: 8,
    font: courier,
    color: muted,
  });

  return pdfDoc.save();
}
