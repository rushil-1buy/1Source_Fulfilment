import './document.css';

/**
 * A route group with no application chrome: no sidebar, no top bar, no theming.
 * A printed document must look the same to everyone who receives it, so this
 * layout deliberately drops out of the app's light/dark surfaces and renders
 * black on white paper on a grey desk.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="doc-desk">{children}</div>;
}
