// src/main.tsx

import ReactDOM from 'react-dom/client'
import App from './App'
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  // If StrictMode’s double-render is confusing your BLE logs, 
  // you can comment it out for debugging:
  //
  // <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  // </React.StrictMode>
)
