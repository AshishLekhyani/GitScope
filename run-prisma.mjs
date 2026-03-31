import { execSync } from 'child_process';
import { config } from 'dotenv';

config({ path: '.env' });

try {
  console.log("Pushing schema...");
  execSync('npx prisma db push', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL } });
  console.log("Generating client...");
  execSync('npx prisma generate', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL } });
  console.log("Done.");
} catch (e) {
  console.error(e.message);
}
