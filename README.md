# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Настройка

Backend-переменные окружения задаются в `server/.env` (см. `server/.env.example`).
Обязательные для входа в приложение:

- `APP_PASSWORD` — общий пароль для входа (`POST /api/login`).
- `SESSION_SECRET` — секрет для подписи сессионной cookie (HMAC-SHA256).

Если один из них не задан: в production сервер отвечает 503 на все `/api/*`
запросы (включая логин) и пишет громкую ошибку в лог при старте; в
разработке выводится предупреждение, а запросы проходят без авторизации,
чтобы не блокировать локальную работу без настроенного `.env`.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
