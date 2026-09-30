import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/practice.css';
import './styles/pages.css';
import './components/ui/Modal.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
