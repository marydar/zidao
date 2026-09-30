import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSettings } from '../../store/SettingsContext';
import { useDayStats } from '../../hooks/useProgress';
import { computeStreaks } from '../../services/progress/stats';
import { onStorageError, clearStorageError } from '../../services/storage/db';
import {
  IconBook,
  IconChart,
  IconFlame,
  IconHome,
  IconMoon,
  IconPen,
  IconSettings,
  IconSun,
  IconInfo,
} from '../ui/Icon';

const NAV = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/practice', label: 'Practice', icon: IconPen },
  { to: '/vocabulary', label: 'Vocabulary', icon: IconBook },
  { to: '/progress', label: 'Progress', icon: IconChart },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export function AppShell() {
  const { settings, setSection } = useSettings();
  const days = useDayStats(45);
  const streak = computeStreaks(days);
  const [storageError, setStorageError] = useState('');

  useEffect(() => onStorageError(setStorageError), []);

  const toggleTheme = () => setSection('theme', settings.theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="brand" aria-label="Hanzi Practice home">
          <span className="brand-mark" aria-hidden="true">
            汉
          </span>
          <span>
            <span className="brand-name">Hanzi Practice</span>
            <span className="brand-sub">write · review · master</span>
          </span>
        </NavLink>

        <nav className="app-nav" aria-label="Main navigation">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          {streak.current > 0 ? (
            <span className="streak-pill" title={`${streak.current}-day practice streak`}>
              <IconFlame size={14} />
              {streak.current}
              <span className="streak-label">day streak</span>
            </span>
          ) : null}
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={settings.theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {settings.theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </header>

      {storageError ? (
        <div className="page" style={{ paddingBottom: 0, paddingTop: 14 }}>
          <div className="notice" role="status">
            <IconInfo size={16} />
            <span className="grow">
              Progress can’t be saved on this device ({storageError}). Practice still works — data
              is kept until the page is refreshed.
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                clearStorageError();
                setStorageError('');
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <Outlet />
    </div>
  );
}
