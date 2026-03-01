import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp } from 'antd';
import App from './App';
import 'antd/dist/reset.css';
import './styles/globals.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AntApp>
      <App />
    </AntApp>
  </React.StrictMode>
);
