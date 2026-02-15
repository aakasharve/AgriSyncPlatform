import dotenv from 'dotenv';
dotenv.config();

// Mock localStorage for Node environment
if (typeof localStorage === 'undefined') {
    (global as any).localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
        clear: () => { },
        length: 0,
        key: () => null,
    };
}
console.log("✅ Global mocks initialized");
