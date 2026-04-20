export const varietyCatalog: Record<string, string[]> = {
    'Grapes': ['Super Sonaka', 'Sharad Seedless', 'Thompson Seedless', 'Crimson Seedless', 'Flame Seedless', 'Manik Chaman', 'Other'],
    'Pomegranate': ['Bhagwa', 'Ganesh', 'Mridula', 'Arakta', 'Other'],
    'Tomato': ['Abhinav', 'Shivam', 'Arka Rakshak', 'Other'],
    'Onion': ['Nashik Red', 'Puna Fursungi', 'N-53', 'Other'],
};

export const getVarietiesForCrop = (cropName: string): string[] => {
    return varietyCatalog[cropName] || ['Local', 'Hybrid', 'Other'];
};
