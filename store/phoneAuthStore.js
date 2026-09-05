// phoneAuthStore.js
let confirmationResult = null;

export const setConfirmation = (conf) => {
  confirmationResult = conf;
};

export const getConfirmation = () => confirmationResult;

export const clearConfirmation = () => {
  confirmationResult = null;
};