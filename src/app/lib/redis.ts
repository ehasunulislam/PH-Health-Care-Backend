import { createClient } from 'redis';
import config from '../config';

console.log(config.redis_user, config.redis_password)

export const redisClient = createClient({
    username: config.redis_user,
    password: config.redis_password,
    socket: {
        host: config.redis_host,
        port: Number(config.redis_port)
    }
});

