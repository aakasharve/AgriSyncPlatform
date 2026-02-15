import { GoogleGenAI } from '@google/genai';

const parseJson = (text: string): any => {
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1) {
        return {};
    }

    return JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
};

export const processPattiImage = async (
    imageData: string,
    mimeType: string,
    cropName: string
): Promise<any> => {
    const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY
        || (import.meta as any).env.VITE_API_KEY
        || (import.meta as any).env.GEMINI_API_KEY
        || (import.meta as any).env.API_KEY;

    if (!apiKey) {
        throw new Error('Gemini API key is missing in environment variables');
    }

    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction = `
You are an AI specialized in Indian agriculture receipts (patti).
Target Crop: ${cropName}.
Extract: Date, Patti Number, Buyer Name.
Extract line items: Grade Name, Quantity, Unit, Rate, Rate Unit, Amount.
Extract deductions: Commission, Transport, Hamali, Bharai, Tolai, Motor Fee, Other.
Calculate Gross Total and Net Amount.
Return strict JSON.
`;

    const result = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
            {
                role: 'user',
                parts: [
                    { text: 'Analyze this receipt image and extract data.' },
                    { inlineData: { mimeType, data: imageData } }
                ]
            }
        ],
        config: {
            systemInstruction,
            responseMimeType: 'application/json'
        }
    });

    return parseJson(result.text || '{}');
};
