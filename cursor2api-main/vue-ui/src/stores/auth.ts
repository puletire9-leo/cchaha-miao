import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('cursor2api_token'));
  const loggedIn = ref(!!token.value);

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('cursor2api_token', t);
    loggedIn.value = true;
  }

  function clearToken() {
    token.value = null;
    localStorage.removeItem('cursor2api_token');
  }

  function logout() {
    clearToken();
    loggedIn.value = false;
  }

  const isLoggedIn = () => !!token.value;

  return { token, loggedIn, setToken, clearToken, logout, isLoggedIn };
});
