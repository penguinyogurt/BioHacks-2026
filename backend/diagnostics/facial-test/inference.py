from pathlib import Path
import sys
import cv2
import numpy as np
from PIL import Image
import torch
from torchvision import transforms

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/"assets/runtime"))
from models.PosterV2_7cls import pyramid_trans_expr2

LABELS=("Surprised","Fearful","Disgusted","Happy","Sad","Angry","Neutral")
# YuNet median landmark positions in 100px aligned RAF crops (81 single detections).
TEMPLATE=np.float32([[27.52,32.18],[70.53,31.27],[48.51,56.12],[30.50,73.23],[68.76,72.66]])


class Predictor:
    def __init__(self,device=None):
        self.device=device or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
        self.net=pyramid_trans_expr2(img_size=224,num_classes=7)
        self.net.load_state_dict(torch.load(ROOT/"assets/inference.pt",weights_only=True,map_location="cpu"),strict=True)
        self.net.eval().requires_grad_(False).to(self.device)
        self.transform=transforms.Compose([transforms.Resize((224,224)),transforms.ToTensor(),
              transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
        self.detector=cv2.FaceDetectorYN.create(str(ROOT/"assets/yunet.onnx"),"",(320,320),0.8)

    @torch.inference_mode()
    def probabilities(self,aligned):
        x=self.transform(Image.fromarray(cv2.cvtColor(aligned,cv2.COLOR_BGR2RGB)))
        logits=self.net(x.unsqueeze(0).to(self.device))
        return logits.softmax(1)[0].cpu().tolist()

    def photo(self,bgr):
        h,w=bgr.shape[:2]
        scale=min(1.,960/max(h,w))
        preview=cv2.resize(bgr,(round(w*scale),round(h*scale))) if scale<1 else bgr
        self.detector.setInputSize((preview.shape[1],preview.shape[0]))
        faces=self.detector.detect(preview)[1]
        count=0 if faces is None else len(faces)
        if count!=1:
            return {"faces":count}
        landmarks=faces[0,4:14].reshape(5,2)/scale
        # Five-point least-squares affine registration to aligned RAF geometry.
        matrix=np.linalg.lstsq(np.column_stack([landmarks,np.ones(5)]),TEMPLATE,rcond=None)[0].T
        crop=cv2.warpAffine(bgr,matrix,(100,100),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
        return {"faces":1,"probabilities":dict(zip(LABELS,self.probabilities(crop)))}
