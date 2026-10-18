import ReactDOM from 'react-dom/client'
import { Help } from './features/help/Help'
import '@fontsource-variable/inter/wght.css'
import './app/styles.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <main className="flex h-dvh flex-col">
    <Help />
  </main>,
)
