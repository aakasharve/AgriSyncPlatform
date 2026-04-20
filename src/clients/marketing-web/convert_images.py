import os
import glob
from PIL import Image

source_dir = r"C:\Users\akash\.gemini\antigravity\brain\380ad534-5a35-4a42-bb82-fe8c95a7f155"
target_dir = r"E:\APPS\Running App Versions\AgriSyncPlatform\src\clients\marketing-web\public\images\generated"

os.makedirs(target_dir, exist_ok=True)

png_files = glob.glob(os.path.join(source_dir, "*.png"))
for png_file in png_files:
    base_name = os.path.basename(png_file)
    name_parts = base_name.rsplit('_', 1)
    if len(name_parts) == 2:
        clean_name = name_parts[0].replace('_', '-') + ".webp"
    else:
        clean_name = base_name.replace('.png', '.webp').replace('_', '-')
    
    output_path = os.path.join(target_dir, clean_name)
    
    print(f"Converting {base_name} to {clean_name}...")
    try:
        with Image.open(png_file) as img:
            img.save(output_path, "WEBP", quality=80)
    except Exception as e:
        print(f"Failed to convert {base_name}: {e}")

print("Done converting images.")
