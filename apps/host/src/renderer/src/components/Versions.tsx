/*
 * ЧТО: Компонент отображения версий Electron, Chromium, Node.
 * ЗАЧЕМ: Показывает информацию о runtime-окружении (для отладки).
 * КТО ИСПОЛЬЗУЕТ: App.tsx.
 *
 * TODO: Вероятно, удалить или переместить в dev-only режим.
 */
import { useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron.process.versions)

  return (
    <ul className="versions">
      <li className="electron-version">Electron v{versions.electron}</li>
      <li className="chrome-version">Chromium v{versions.chrome}</li>
      <li className="node-version">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
