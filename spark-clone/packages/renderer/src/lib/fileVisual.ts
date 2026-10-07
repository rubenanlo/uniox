import {
  CalendarDays,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

export interface FileVisual {
  Icon: LucideIcon;
  /** Tailwind classes for the icon tile (Spark-style colored square). */
  tile: string;
  /** Short uppercase type label, e.g. "PDF", "XLSX". */
  label: string;
}

const EXT = /\.([a-z0-9]+)$/i;

/** Spark-style file identity: icon + tile color + type label, by mime/extension. */
export function fileVisual(contentType: string, filename: string): FileVisual {
  const ext = (EXT.exec(filename)?.[1] ?? '').toUpperCase();
  const ct = contentType.toLowerCase();
  const label = (l: string) => ext || l;

  if (ct === 'application/pdf' || ext === 'PDF')
    return { Icon: FileText, tile: 'bg-red-500/15 text-red-500', label: 'PDF' };
  if (ct.includes('spreadsheet') || ct.includes('ms-excel') || /^(XLSX?|CSV|NUMBERS)$/.test(ext))
    return { Icon: FileSpreadsheet, tile: 'bg-emerald-500/15 text-emerald-600', label: label('SHEET') };
  if (ct.includes('wordprocessing') || ct.includes('msword') || /^(DOCX?|PAGES|RTF)$/.test(ext))
    return { Icon: FileText, tile: 'bg-blue-500/15 text-blue-500', label: label('DOC') };
  if (ct.includes('presentation') || /^(PPTX?|KEY)$/.test(ext))
    return { Icon: FileText, tile: 'bg-orange-500/15 text-orange-500', label: label('SLIDES') };
  if (ct === 'text/calendar' || ct === 'application/ics' || ext === 'ICS')
    return { Icon: CalendarDays, tile: 'bg-teal-500/15 text-teal-600', label: 'EVENT' };
  if (ct.startsWith('image/'))
    return { Icon: FileImage, tile: 'bg-purple-500/15 text-purple-500', label: label('IMAGE') };
  if (ct.startsWith('video/'))
    return { Icon: FileVideo, tile: 'bg-pink-500/15 text-pink-500', label: label('VIDEO') };
  if (ct.startsWith('audio/'))
    return { Icon: FileAudio, tile: 'bg-indigo-500/15 text-indigo-500', label: label('AUDIO') };
  if (ct.includes('zip') || ct.includes('compressed') || /^(ZIP|GZ|TAR|RAR|7Z)$/.test(ext))
    return { Icon: FileArchive, tile: 'bg-amber-500/15 text-amber-600', label: label('ARCHIVE') };
  return { Icon: File, tile: 'bg-sunken text-ink-muted', label: label('FILE') };
}
