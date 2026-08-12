export default function PlaceholderPage({ title }: { title: string }): JSX.Element {
  return (
    <div className="page">
      <header className="page-header">
        <h1>{title}</h1>
        <span className="title-underline" />
      </header>
      <div className="placeholder">该模块开发中</div>
    </div>
  )
}
