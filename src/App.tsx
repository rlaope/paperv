import { useEffect, useState } from 'react'
import { systemGetInfo, type SystemInfo } from './api/system'

type StartupState = { status: 'loading' } | { status: 'ready'; info: SystemInfo } | { status: 'error' }
const readinessKeys = ['paprvReady', 'paprvPlatform', 'paprvVersion'] as const

function clearReadiness(): void {
  for (const key of readinessKeys) delete document.documentElement.dataset[key]
}

export function App(): React.JSX.Element {
  const [startup, setStartup] = useState<StartupState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    clearReadiness()
    void systemGetInfo().then(
      (info) => { if (active) setStartup({ status: 'ready', info }) },
      () => { if (active) setStartup({ status: 'error' }) }
    )
    return () => { active = false; clearReadiness() }
  }, [])

  useEffect(() => {
    if (startup.status !== 'ready') return
    document.documentElement.dataset.paprvPlatform = startup.info.platform
    document.documentElement.dataset.paprvVersion = startup.info.version
    document.documentElement.dataset.paprvReady = 'true'
    return clearReadiness
  }, [startup])

  return <main className="shell">
    <header>
      <p className="eyebrow">PAPRV · M0</p>
      <h1>논문을 근거와 함께 배우는 작업 공간</h1>
      <p>안전한 데스크톱 기반이 준비되었습니다. 논문 가져오기와 AI 기능은 다음 마일스톤에서 활성화됩니다.</p>
      {startup.status === 'loading' && <p aria-live="polite">시작 정보를 확인하고 있습니다.</p>}
      {startup.status === 'ready' && <p aria-live="polite">실행 환경: {startup.info.platform} · 버전 {startup.info.version}</p>}
      {startup.status === 'error' && <p role="alert">시작 정보를 확인할 수 없습니다.</p>}
    </header>
    <section aria-labelledby="foundation-heading">
      <h2 id="foundation-heading">Project foundation</h2>
      <ul>
        <li>Tauri webview와 Rust 권한 경계</li>
        <li>검증된 최소 command allowlist</li>
        <li>Reversible Rust SQLite migrations</li>
      </ul>
    </section>
  </main>
}
