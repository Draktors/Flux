import { createRoot } from 'react-dom/client'
import type { FluxApi } from '../../shared/types'
import { App } from './App'
import { Capture } from './Capture'
import './styles.css'

declare global {
  interface Window {
    flux: FluxApi
  }
}

document.documentElement.classList.toggle('is-capture', window.location.hash === '#capture')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(window.location.hash === '#capture' ? <Capture /> : <App />)
