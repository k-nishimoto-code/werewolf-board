import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StreamWindow from './StreamWindow.tsx'
import { STREAM_WINDOW_QUERY_KEY, STREAM_WINDOW_QUERY_VALUE } from './streaming.ts'

const searchParams = new URLSearchParams(window.location.search)
const isStreamWindow = searchParams.get(STREAM_WINDOW_QUERY_KEY) === STREAM_WINDOW_QUERY_VALUE

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStreamWindow ? <StreamWindow /> : <App />}
  </StrictMode>,
)
