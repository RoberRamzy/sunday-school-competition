const paths = {
  book: <><path d="M12 7c-3-2.5-6-2.5-9-1v13c3-1.5 6-1.5 9 1 3-2.5 6-2.5 9-1V6c-3-1.5-6-1.5-9 1z"/><path d="M12 7v13M12 1v4M10 3h4"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  eye: <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></>,
  hide: <><path d="m3 3 18 18M10 6h2c6 0 10 6 10 6a16 16 0 0 1-3 3M6 7a17 17 0 0 0-4 5s4 6 10 6a10 10 0 0 0 4-1"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M2 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M17 5a3 3 0 0 1 0 6m1 3a4 4 0 0 1 4 4v2"/></>,
  palette: <><path d="M21 11a8.9 8.9 0 0 0-9-8 9 9 0 0 0 0 18h1a2 2 0 0 0 2-2c0-1.5-1-2-1-3s.5-2 2-2h2a3 3 0 0 0 3-3z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 10h.01"/></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
  logout: <path d="M12 4H4v16h8m3-12 4 4-4 4m-7-4h11"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  star: <path d="M12 2c.8 6 3.1 8.3 9 10-5.9 1.7-8.2 4-9 10-.8-6-3.1-8.3-9-10 5.9-1.7 8.2-4 9-10Z" fill="currentColor" stroke="none"/>,
  tree: <><path d="m12 2 5 6h-2.5l4.5 5h-3l4 6H4l4-6H5l4.5-5H7l5-6Z" fill="#315c48"/><path d="M12 19v3"/><path d="M10 9h.01M14 12h.01M9 15.5h.01M15.5 16h.01" stroke="#ffe1a0" strokeWidth="2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  music: <><path d="M10 17V5l9-2v12M10 8l9-2"/><ellipse cx="7" cy="17" rx="3" ry="2"/><ellipse cx="16" cy="15" rx="3" ry="2"/></>,
  up: <path d="m6 15 6-6 6 6"/>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
