"""Fixed 1280x960 official Creator controls shared by additional GUI audits.

Inspection only, not an application renderer. No parameters are armed, keys
edited, images painted or user artwork sent to another service.
"""
import io
import os
from pathlib import Path
import re
import subprocess
import time

from PIL import Image,ImageOps


class CreatorUI:
    def __init__(self,xdotool,display,model,input_scale=2.5):
        self.scale=input_scale
        self.tool=xdotool;self.env=os.environ.copy();self.env['DISPLAY']=display
        self.env['LD_LIBRARY_PATH']=str(Path(xdotool).resolve().parents[1]/'lib/x86_64-linux-gnu')+':'+self.env.get('LD_LIBRARY_PATH','')
        windows=self.xdo('search','--onlyvisible','--name','^Inochi Creator').splitlines()
        if len(windows)!=1:raise ValueError('Exactly one official Creator window is required.')
        self.window=windows[0];self.title=self.xdo('getwindowname',self.window)
        if Path(model).name not in self.title:raise ValueError('Creator title does not match model filename.')
        if self.xdo('getdisplaygeometry')!='1280 960':raise ValueError('GUI audit requires documented 1280x960 display.')
        self.xdo('windowfocus','--sync',self.window)

    def xdo(self,*parts):return subprocess.check_output([self.tool,*map(str,parts)],env=self.env).decode().strip()

    def click(self,x,y,shift=False,hold=.25):
        self.xdo('mousemove',x,y);time.sleep(.1*self.scale)
        if shift:self.xdo('keydown','Shift_L');time.sleep(.08*self.scale)
        self.xdo('mousedown',1);time.sleep(hold*self.scale);self.xdo('mouseup',1);time.sleep(.08*self.scale)
        if shift:self.xdo('keyup','Shift_L')

    def snapshot(self):
        # PNG encoding here missed sub-second pendulum peaks. Capture bounded
        # raw X11 pixels; encode evidence only after the timed sequence.
        data=subprocess.check_output(['import','-window','root','-depth','8','rgb:-'],env=self.env)
        if len(data)!=1280*960*3:raise ValueError('GUI pixel dimensions changed during audit.')
        return Image.frombytes('RGB',(1280,960),data)

    def text(self,image,box,numeric=False):
        crop=ImageOps.invert(image.crop(box).convert('L')).resize(((box[2]-box[0])*4,(box[3]-box[1])*4))
        data=io.BytesIO();crop.save(data,'PNG');cmd=['tesseract','stdin','stdout','--psm','7']
        if numeric:cmd+=['-c','tessedit_char_whitelist=0123456789.-']
        return subprocess.run(cmd,input=data.getvalue(),capture_output=True,check=True,
                              env={**os.environ,'OMP_THREAD_LIMIT':'1'}).stdout.decode().strip()

    def value(self,image,top):
        text=self.text(image,(130,top,192,top+22),True)
        if not re.fullmatch(r'-?\d+\.\d+',text):raise ValueError('Unverified numeric control: '+repr(text))
        return float(text)

    def filter(self,name):
        self.click(220,92)
        self.xdo('keydown','Control_L');time.sleep(.12*self.scale)
        self.key('a');self.xdo('keyup','Control_L');time.sleep(.1*self.scale)
        self.key('BackSpace')
        # Creator lowercases the ImGui buffer while typing. Sending uppercase
        # with simulated Shift can race that edit; enter its native lowercase
        # search representation and verify the displayed heading in the audit.
        # SDL polls key edges on render frames. xdotool type releases a key
        # immediately even with --delay, so a slow software frame can lose
        # letters. Hold each ordinary lowercase key across several frames.
        for letter in name.lower():self.key(letter)
        self.key('Return');time.sleep(.4*self.scale)

    def key(self,name):
        self.xdo('keydown',name);time.sleep(.12*self.scale);self.xdo('keyup',name);time.sleep(.1*self.scale)

    def pointer_away(self):self.xdo('mousemove',1200,850)
