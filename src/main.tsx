// src/main.tsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material'

const theme = createTheme({
  palette: {
    mode: 'light',
    // Optionally customize primary, secondary, etc.
    primary: {
      main: '#1976d2',
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      {/* Global baseline styles (background = white, etc.) */}
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)