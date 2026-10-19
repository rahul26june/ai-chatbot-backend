import redisClient from "../config/redis.js";

const CACHE_EXPIRATION_TIME = 3600; // 1 hour in seconds

export async function getCache(key) {
  try {
    const cachedData = await redisClient.get(key);
    return cachedData === null ? null : JSON.parse(cachedData);
  } catch (error) {
    console.error("Error retrieving cached response:", error);
    return null;
  }
}

export async function setCache(key, data) {
  try {
    await redisClient.setEx(key, CACHE_EXPIRATION_TIME, JSON.stringify(data));
  } catch (error) {
    console.error("Error setting cached response:", error);
  }
}

export async function deleteCachedResponse(key) {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error("Error deleting cached response:", error);
  }
}
