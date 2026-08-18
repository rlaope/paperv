export function App(): React.JSX.Element {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">PAPRV · M0</p>
        <h1>논문을 근거와 함께 배우는 작업 공간</h1>
        <p>안전한 데스크톱 기반이 준비되었습니다. 논문 가져오기와 AI 기능은 다음 마일스톤에서 활성화됩니다.</p>
      </header>
      <section aria-labelledby="foundation-heading">
        <h2 id="foundation-heading">Project foundation</h2>
        <ul>
          <li>Main, preload, renderer 프로세스 분리</li>
          <li>Sandboxed renderer와 검증된 IPC</li>
          <li>Reversible SQLite migrations</li>
        </ul>
      </section>
    </main>
  )
}
