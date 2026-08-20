import config from "../config"
import { redisClient } from "./redis";

export const getBkasToken = async() => {
    try {
        const IDTokenKey = "bkas:idToken";
        const RefreshToken = "bkas:refreshToken"

        let bkasIDToken = await redisClient.get(IDTokenKey);
        const bkasIDTokenTTL = await redisClient.ttl(IDTokenKey);

        const bkasRefreshToken = await redisClient.get(RefreshToken);
        const bkasRefreshTokenTTL = await redisClient.ttl(RefreshToken);

        // Have bkasIdToken less than or equal 10 min or bkas id is expire
        // Have bkas refreshToken 
        // Have bkas refreshToken more than 10 min  
        if((bkasIDTokenTTL<= 600 || !bkasIDToken) && bkasRefreshToken && bkasRefreshTokenTTL > 600) {
            const RefreshTokenResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/refresh`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    userName: config.bkash_username,
                    password: config.bkash_password
                },
                body: JSON.stringify({  
                    app_key: config.bkash_app_key,
                    app_secret: config.bkash_app_secret,
                    refresh_token: bkasRefreshToken
                })
            });

            if(!RefreshTokenResponse.ok) {
                throw new Error("Bkas AccessToken Grant Failed");
            }

            const bkasRefreshTokenResult = await RefreshTokenResponse.json();

            bkasIDToken = bkasRefreshTokenResult.id_token as string;

            await redisClient.set(IDTokenKey, bkasIDToken, {
                expiration: {
                    type: "EX",
                    value: 60 * 60
                }
            })

            return bkasIDToken;
        }

        if(bkasIDTokenTTL > 600) {
            return bkasIDToken
        }

        /* from bkas documentation */
        const response = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/grant`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                userName: config.bkash_username,
                password: config.bkash_password
            },
            body: JSON.stringify({  
                app_key: config.bkash_app_key,
                app_secret: config.bkash_app_secret
            })
        });

        if(!response.ok) {
            throw new Error("Bkas AccessToken Grant Failed");
        }

        const result = await response.json();


        /* bkas id_token set with redis */
        await redisClient.set(IDTokenKey, result.id_token, {
            expiration: {
                type: "EX",
                value: 60* 60  // 1 hour
            }
        });

        /* bkas refresh_token set with redis */
        await redisClient.set(RefreshToken, result.refresh_token, {
            expiration: {
                type: "EX",
                value: 60* 60 * 24 * 28 // 28 days
            }
        });

        bkasIDToken = result.id_token

        return bkasIDToken
    } catch (error: any) {
        throw new Error (error.message)
    }
}