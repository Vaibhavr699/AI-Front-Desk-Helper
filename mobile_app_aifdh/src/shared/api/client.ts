import axios from "axios";

import { API_BASE_URL, APP_VERSION } from "@/src/config/env";

import { ApiError } from "./errors";

let currentToken: string | null = null;

export const authTokenHolder = {
  set(token: string | null) {
    currentToken = token;
  },
  get(): string | null {
    return currentToken;
  },
};

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = currentToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["x-app-version"] = APP_VERSION;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(ApiError.fromAxios(error)),
);
