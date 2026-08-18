import type { SVGProps } from 'react'

export type IconName =
  | 'library' | 'search' | 'file-plus' | 'quote' | 'link' | 'panel-right'
  | 'sun' | 'moon' | 'edit' | 'eye' | 'bold' | 'code' | 'external-link'
  | 'x' | 'loader' | 'alert' | 'check' | 'refresh' | 'file' | 'command'

const paths: Record<IconName, React.ReactNode> = {
  library: <><path d="M4 5.5h5.5v14H4z"/><path d="M9.5 5.5h5v14h-5z"/><path d="m14.5 6.5 4.1-1 2.4 13.7-4.1.8z"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
  'file-plus': <><path d="M6 2.75h8l4 4V21H6z"/><path d="M14 2.75V7h4M9 14h6m-3-3v6"/></>,
  quote: <><path d="M5 7h5v5H6c0 3-1 4.5-3 5.5"/><path d="M14 7h5v5h-4c0 3-1 4.5-3 5.5"/></>,
  link: <><path d="m10 13 4-4"/><path d="M7.5 15.5 6 17a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0"/><path d="M16.5 8.5 18 7a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/></>,
  'panel-right': <><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M15 4v16"/></>,
  sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></>,
  moon: <path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z"/>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  bold: <><path d="M7 4h6a4 4 0 0 1 0 8H7z"/><path d="M7 12h7a4 4 0 0 1 0 8H7z"/></>,
  code: <><path d="m8 9-3 3 3 3m8-6 3 3-3 3m-2-9-4 12"/></>,
  'external-link': <><path d="M14 4h6v6m0-6-9 9"/><path d="M18 13v6H5V6h6"/></>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
  loader: <path d="M21 12a9 9 0 1 1-5.2-8.2"/>,
  alert: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v4m0 3.5v.5"/></>,
  check: <path d="m4 12.5 5 5L20 6.5"/>,
  refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .7-8.8L20 12"/></>,
  file: <><path d="M6 2.75h8l4 4V21H6z"/><path d="M14 2.75V7h4"/></>,
  command: <><path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H18"/><path d="M15 6.5A2.5 2.5 0 1 1 17.5 9H6"/><path d="M9 15H6.5A2.5 2.5 0 1 0 9 17.5V6"/><path d="M15 9v8.5A2.5 2.5 0 1 0 17.5 15H6"/></>
}

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & { name: IconName; size?: number }

export function Icon({ name, size = 18, ...props }: Props): React.JSX.Element {
  return <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >{paths[name]}</svg>
}
