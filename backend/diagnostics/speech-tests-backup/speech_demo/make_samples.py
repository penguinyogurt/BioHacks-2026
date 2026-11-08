"""Regenerate the local demo WAVs with one whole-passage macOS say call per file."""
import subprocess
from engine import ROOT, PASSAGE

folder=ROOT/"samples"
folder.mkdir(exist_ok=True,parents=True)
for name,rate,text in [("baseline",170,PASSAGE),("slower",127,PASSAGE),
                       ("edited",170,PASSAGE.replace("morning ","").replace("window","door")),
                       ("reference",150,PASSAGE)]:
    subprocess.run(["/usr/bin/say","-v","Samantha","-r",str(rate),"-o",str(folder/(name+".wav")),
                    "--data-format=LEI16@16000",text],check=True)
