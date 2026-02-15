import dotenv from 'dotenv';
dotenv.config();

console.log("DEBUG: Loading .env");
console.log("DEBUG: GEMINI_API_KEY present?", !!process.env.GEMINI_API_KEY);
console.log("DEBUG: API_KEY present?", !!process.env.API_KEY);
console.log("DEBUG: Done");
