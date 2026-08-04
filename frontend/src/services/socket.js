import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  autoConnect: false,
  auth: (cb) => cb({ token: localStorage.getItem('agms_token') }),
});

export default socket;
