
import { GoogleGenAI } from "@google/genai";
import { ReceiptExtractionResponse, ExpenseCategory, ExpenseScope } from "../types";

const SYSTEM_PROMPT = `
You are an agricultural expense extraction assistant for Indian farmers.

CONTEXT:
- This is a receipt/bill from a farm input dealer or shop
- May be handwritten or printed
- Language could be Hindi, Marathi, English, or mixed
- Common items: fertilizers (DAP, Urea, Potash), pesticides, seeds, labour payments, machinery repairs

YOUR TASK:
1. Extract ALL text from the image.
2. Identify line items with names, quantities, units, and prices.
3. Categorize each item into one of the following: FERTILIZER, PESTICIDE, FUNGICIDE, SEEDS_PLANTS, IRRIGATION, LABOUR, MACHINERY_RENTAL, FUEL, TRANSPORT, PACKAGING, ELECTRICITY, EQUIPMENT_REPAIR, MISC.
4. Calculate totals if missing or unclear.
5. Suggest if this is PLOT-specific, CROP-level, or FARM-general expense based on the item names (e.g., specific pesticide = CROP, electricity = FARM).

OUTPUT FORMAT (JSON ONLY):
{
  "success": true,
  "confidence": 0-100, // Overall confidence
  "vendorName": "extracted vendor name or null",
  "vendorPhone": "extracted phone or null",
  "date": "YYYY-MM-DD", // Best guess or today if missing
  "lineItems": [
    {
      "name": "item name",
      "quantity": 10,
      "unit": "kg",
      "unitPrice": 500,
      "totalAmount": 5000,
      "suggestedCategory": "FERTILIZER",
      "confidence": 90
    }
  ],
  "subtotal": 5000,
  "discount": 0,
  "tax": 0,
  "grandTotal": 5000,
  "suggestedScope": "PLOT|CROP|FARM|UNKNOWN",
  "suggestedCropName": "Tomato (if detected)",
  "rawTextExtracted": "Full extracted text for verification...",
  "warnings": ["Low confidence on date", "Handwriting unclear"]
}
`;

const parseJson = (text: string) => {
    try {
        const cleanText = text.replace(/```json\n?|\n?```/g, "").trim();
        const firstBrace = cleanText.indexOf('{');
        const lastBrace = cleanText.lastIndexOf('}');
        let jsonStr = cleanText;
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = cleanText.substring(firstBrace, lastBrace + 1);
        }
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse receipt JSON:", e);
        return {
            success: false,
            confidence: 0,
            rawTextExtracted: text,
            warnings: ["JSON Parse Error"]
        };
    }
};

export const extractReceiptData = async (imageBase64: string): Promise<ReceiptExtractionResponse> => {
    if (!process.env.API_KEY) {
        console.error("API Key missing");
        throw new Error("API Key missing");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-2.0-flash"; // Excellent for vision & speed

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: SYSTEM_PROMPT },
                        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } } // Assuming JPEG or generic base64 handling
                    ]
                }
            ],
            config: {
                responseMimeType: 'application/json'
            }
        });

        return parseJson(response.text || "{}") as ReceiptExtractionResponse;

    } catch (error: any) {
        console.error("Receipt extraction failed:", error);
        return {
            success: false,
            confidence: 0,
            rawTextExtracted: "Extraction Failed: " + error.message,
            lineItems: [],
            // return specific failure structure
            subtotal: 0, grandTotal: 0, suggestedScope: 'UNKNOWN', warnings: ["API Error"]
        } as ReceiptExtractionResponse;
    }
};
