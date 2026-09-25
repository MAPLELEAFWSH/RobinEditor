import numpy as np
from PIL import Image
a = np.fromfile("tmp/region-data/gi_body.raw", dtype=np.uint8).reshape(1024,1024,4)
Image.fromarray(a, "RGBA").save("tmp/region-data/预览用基础色.png")
print("写到 tmp/region-data/预览用基础色.png")
