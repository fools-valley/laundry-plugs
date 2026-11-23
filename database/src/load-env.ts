import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });
if (process.env.ENV_FILE) dotenv.config({ path: process.env.ENV_FILE, quiet: true });
