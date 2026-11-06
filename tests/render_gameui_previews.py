"""Render original illustrative covers for Hamoki Studio's game UI tools.

These covers are visual examples, NOT AI-generated output or evidence of engine capability.
The existing ui-tool-*.webp layout diagrams are deliberately left untouched.
"""
from __future__ import annotations
import hashlib
import json
import math
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/"assets"
W,H=640,400
COLORS={
 "UI界面":("#111c31","#142f46","#4cb9ff","#ffba63"),
 "图标道具":("#221a36","#253b53","#cf8aff","#ffc85b"),
 "角色生物":("#241e3f","#27385c","#9c8aff","#ff8fbb"),
 "场景建筑":("#102f35","#264a54","#63d8b7","#e6bb75"),
 "海报宣发":("#301b32","#4d253e","#ff9774","#ffd17b"),
 "特效材质":("#191c45","#3c2559","#b58dff","#63edfb"),
 "图像处理":("#192b36","#27455a","#78ddda","#ffbf76"),
 "灵感设定":("#27333b","#465269","#b9ce93","#e4b59c"),
 "质检交付":("#182b3a","#294b46","#86ddb6","#7aaef7"),
 "买量":("#31233a","#563345","#ffb25f","#fa718c"),
 "小游戏":("#193947","#25505d","#ffc96c","#84e3dd"),
 "文游":("#302638","#5c4050","#edc59b","#cda2ef"),
}
def col(h):
 h=h.lstrip("#");return tuple(int(h[i:i+2],16) for i in (0,2,4))
def mix(a,b,t):
 return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))
def grad(im,a,b):
 d=ImageDraw.Draw(im)
 a,b=col(a),col(b)
 for y in range(H):
  t=y/(H-1)
  d.line((0,y,W,y),fill=mix(a,b,t))
def glow(im,xy,r,color,opacity=120):
 l=Image.new("RGBA",(W,H));d=ImageDraw.Draw(l)
 x,y=xy;c=col(color)
 d.ellipse((x-r,y-r,x+r,y+r),fill=(*c,opacity))
 l=l.filter(ImageFilter.GaussianBlur(int(r*.58)))
 im.paste(l,(0,0),l)
def pbox(d,box,fill,outline=None,r=16,width=2):
 d.rounded_rectangle(tuple(map(int,box)),radius=r,fill=fill,outline=outline,width=width)
def poly(d,xy,fill,outline=None,width=2):
 d.polygon(xy,fill=fill)
 if outline:d.line(xy+[xy[0]],fill=outline,width=width,joint="curve")
def line(d,xy,fill,width=3):
 d.line(xy,fill=fill,width=width,joint="curve")
try:
 FONT="C:/Windows/Fonts/msyh.ttc"
 ImageFont.truetype(FONT,20)
except:
 FONT="C:/Windows/Fonts/arial.ttf"
def font(n):
 try:return ImageFont.truetype(FONT,n)
 except:return ImageFont.load_default()
def spark(d,x,y,color,size=9):
 line(d,[(x-size,y),(x+size,y)],color,2)
 line(d,[(x,y-size),(x,y+size)],color,2)
 d.ellipse((x-2,y-2,x+2,y+2),fill="#fff3d0")
def draw_gem(d,x,y,s,color):
 poly(d,[(x,y-s),(x+s*.88,y),(x,y+s*1.07),(x-s*.88,y)],color,"#d7edff",2)
 poly(d,[(x,y-s),(x+s*.88,y),(x,y+s*.08)],"#e1f6ff",None)
 line(d,[(x,y-s),(x,y+s*.99)],"#ffffff85",2)
def draw_sword(d,x,y,s,color):
 line(d,[(x,y+s*.45),(x,y-s*.65)],"#e8f8fd",max(3,int(s*.18)))
 poly(d,[(x-7*s/30,y-s*.55),(x,y-s),(x+7*s/30,y-s*.55)],"#f2f7fd")
 line(d,[(x-s*.55,y+s*.38),(x+s*.55,y+s*.38)],color,max(3,int(s*.22)))
 line(d,[(x,y+s*.28),(x,y+s*.8)],"#8d5a3a",max(4,int(s*.15)))
 d.ellipse((x-4,y+s*.7,x+4,y+s*.9),fill="#ffe5a1")
def draw_shield(d,x,y,s,color):
 poly(d,[(x-s*.72,y-s*.7),(x+s*.72,y-s*.7),(x+s*.65,y+s*.22),(x,y+s),(x-s*.65,y+s*.22)],color,"#e6d18c",3)
 poly(d,[(x,y-s*.4),(x+s*.35,y),(x,y+s*.44),(x-s*.35,y)],"#e9f6ff")
def draw_potion(d,x,y,s,color):
 d.ellipse((x-s*.49,y-s*.05,x+s*.49,y+s*.76),fill=color,outline="#e4f4fc",width=3)
 pbox(d,(x-s*.3,y-s*.52,x+s*.3,y-s*.12),"#e6e7d6","#fff8ca",4,2)
 pbox(d,(x-s*.24,y-s*.62,x+s*.24,y-s*.42),"#765a4e","#f1dabb",4,1)
 d.ellipse((x-s*.32,y+s*.22,x-s*.13,y+s*.4),fill="#ffffffb0")
def draw_coins(d,x,y,s,color):
 for ox,oy in ((-7,5),(8,12),(0,-8)):
  d.ellipse((x-s*.55+ox,y-s*.55+oy,x+s*.55+ox,y+s*.55+oy),fill="#b76f32",outline="#ffcc69",width=4)
  d.ellipse((x-s*.35+ox,y-s*.35+oy,x+s*.35+ox,y+s*.35+oy),outline="#fff2a3",width=3)
def draw_star(d,x,y,s,color):
 poly(d,[(x,y-s),(x+s*.22,y-s*.23),(x+s,y),(x+s*.23,y+s*.22),(x,y+s),(x-s*.22,y+s*.22),(x-s,y),(x-s*.22,y-s*.23)],color,"#fff1d3",2)
def icon(d,x,y,s,which,accent):
 arr=["gem","sword","potion","shield","coins","star"]
 which=arr[which%len(arr)]
 if which=="gem":draw_gem(d,x,y,s,accent)
 elif which=="sword":draw_sword(d,x,y,s,accent)
 elif which=="potion":draw_potion(d,x,y,s,accent)
 elif which=="shield":draw_shield(d,x,y,s,accent)
 elif which=="coins":draw_coins(d,x,y,s,accent)
 else:draw_star(d,x,y,s,accent)
def draw_icon_sheet(im,rng,accent,other,variant=0):
 d=ImageDraw.Draw(im,"RGBA")
 pbox(d,(58,54,582,346),(16,28,48,230),(164,205,231,105),24,3)
 d.line((88,94,551,94),fill=(*col(accent),130),width=2)
 for k in range(3):
  for j in range(2):
   idx=k*2+j
   x=157+162*k;y=158+120*j
   pbox(d,(x-54,y-50,x+54,y+50),(35+idx*3,43,78,255),(164,203,245,125),15,3)
   d.ellipse((x-38,y-36,x+38,y+39),fill=(*col(accent),35))
   icon(d,x,y,32,(idx+variant)%6,other if idx%2 else accent)
   d.ellipse((x+36,y-41,x+42,y-35),fill="#fff0c5")
def draw_character(d,cx,base,scale,accent,secondary,rng,mode=0):
 def q(a,b):return (int(cx+a*scale),int(base+b*scale))
 def box(a,b,c,e):return (*q(a,b),*q(c,e))
 d.ellipse(box(-56,-13,57,3),fill=(0,0,0,95))
 poly(d,[q(-34,-91),q(-49,-15),q(45,-15),q(34,-91)],"#3c3763")
 for o in (-18,17):
  poly(d,[q(o-8,-45),q(o+8,-45),q(o+10,-3),q(o-11,-3)],"#272b4d",secondary,2)
 poly(d,[q(-48,-103),q(42,-105),q(40,-45),q(14,-32),q(-18,-32),q(-44,-47)],"#343b6c",accent,3)
 pbox(d,box(-20,-101,21,-46),"#506391",secondary,14,3)
 for x in (-43,40):
  d.ellipse(box(x-10,-95,x+11,-54),fill="#e8b8aa",outline=accent,width=2)
 d.ellipse(box(-41,-200,42,-118),fill="#f1c8b7",outline="#ffe5d1",width=3)
 d.ellipse(box(-46,-205,41,-161),fill=accent)
 poly(d,[q(-41,-174),q(-50,-198),q(-30,-214),q(-5,-208),q(12,-220),q(39,-202),q(41,-174),q(25,-186),q(2,-178),q(-15,-194)],accent)
 for e in (-20,19):
  d.ellipse(box(e-6,-161,e+2,-154),fill="#20234c")
  d.ellipse(box(e-5,-162,e-2,-159),fill="#ffffff")
 d.arc(box(-11,-147,9,-133),15,165,fill="#ae696f",width=2)
 if mode%2:
  d.ellipse(box(27,-180,55,-158),fill=secondary,outline="#ffedcf",width=3)
 if mode%3==0:
  draw_sword(d,*q(49,-92),int(39*scale),other_color(secondary))
 else:
  draw_gem(d,*q(46,-86),int(13*scale),secondary)
 d.ellipse(box(-13,-93,12,-74),fill=accent,outline="#fff3c4",width=2)
def other_color(s):
 return "#f1dbab" if s.startswith("#") else s
def draw_people(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 d.ellipse((118,292,530,376),fill=(20,14,50,120))
 if any(x in name for x in ("三视","三方向","多角色","成长","进阶","变体","皮肤","换装","形态")):
  for i,x in enumerate((190,320,450)):
   draw_character(d,x,332,.85,accent if i!=1 else other,other,rng,i)
 else:
  draw_character(d,310,355,1.4,accent,other,rng,rng.randrange(6))
  for i in range(7):
   spark(d,rng.randint(100,540),rng.randint(90,295),other,rng.randint(3,8))
def draw_castle(d,x,y,scale,accent):
 def pt(a,b):return (int(x+a*scale),int(y+b*scale))
 poly(d,[pt(-60,-45),pt(65,-45),pt(65,67),pt(-60,67)],"#395a63","#bed7cb",3)
 for k in (-63,0,60):
  poly(d,[pt(k-22,-120),pt(k+22,-120),pt(k+22,67),pt(k-22,67)],"#496774","#aac4be",2)
  poly(d,[pt(k-30,-118),pt(k,-158),pt(k+30,-118)],accent)
  p0=pt(k-5,-92);p1=pt(k+5,-74)
  pbox(d,(*p0,*p1),"#ffe0a3","#e9b16c",3,1)
 pbox(d,(*pt(-19,21),*pt(19,67)),"#1d3041","#c4a678",15,2)
def draw_landscape(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 d.ellipse((449,52,548,151),fill=(*col(other),165))
 for layer,(yy,c) in enumerate(((200,"#36516a"),(248,"#28485a"),(309,"#1b414c"))):
  coords=[(0,400),(0,yy)]
  for k in range(0,641,32):coords.append((k,yy+int(32*math.sin(k*.013+layer*2)+rng.randint(-7,9))))
  coords.extend([(640,400)])
  poly(d,coords,c)
 if any(x in name for x in ("主城","建筑","地图","城镇","关卡","地牢","城堡","街道","楼","室内","大厅")):
  draw_castle(d,320,255,1.08,accent)
 else:
  draw_castle(d,424,246,.63,accent)
 for i in range(8):
  x=rng.choice(list(range(20,220,32))+list(range(468,635,32)))
  h=rng.randrange(24,49);y=rng.randint(310,350)
  poly(d,[(x,y-h),(x-17,y+6),(x+17,y+6)],"#2e7661",None)
  poly(d,[(x,y-h+13),(x-21,y+9),(x+21,y+9)],"#55aa85",None)
 line(d,[(65,359),(575,359)],"#9c8865",5)
 for i in range(4): spark(d,rng.randrange(90,555),rng.randrange(90,250),other,rng.randrange(4,7))
def draw_ui(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 is_hud=any(s in name for s in ("HUD","血条","进度","战斗","技能栏"))
 is_cards=any(s in name for s in ("卡牌","头像框","称号","框设计"))
 is_dialog=any(s in name for s in ("弹窗","对话","提示"))
 if is_cards:
  for i,x in enumerate((148,319,490)):
   pbox(d,(x-61,79,x+61,330),(20,33,61,244),(*col(accent),195),13,4)
   d.ellipse((x-44,115,x+44,204),fill=(*col(other),90),outline=(*col(accent),210),width=3)
   icon(d,x,162,34,i+1,other)
   pbox(d,(x-40,242,x+40,253),(*col(accent),170),None,5,1)
   pbox(d,(x-29,264,x+29,272),(207,224,238,120),None,4,1)
  return
 if is_hud:
  pbox(d,(28,59,255,128),(20,27,56,230),(*col(accent),170),17,2)
  d.ellipse((42,70,88,117),fill=(*col(other),170),outline="#f3f5e9",width=2)
  pbox(d,(100,82,239,96),"#14213c",None,5,1)
  pbox(d,(101,83,209,95),"#f17a87",None,5,1)
  pbox(d,(100,102,220,111),"#172d35",None,5,1)
  pbox(d,(101,103,187,110),accent,None,5,1)
  pbox(d,(496,63,604,173),(19,46,59,210),(*col(other),160),16,3)
  d.arc((517,77,583,152),15,320,fill=other,width=4)
  for i in range(6):
   x=176+57*i;y=325
   pbox(d,(x-22,y-23,x+22,y+20),(35,46,79,250),(*col(accent),170),7,2)
   icon(d,x,y,11,i+1,other)
  for i in range(13):
   d.ellipse((76+i*43,190+(i%3)*3,90+i*43,207+(i%3)*3),fill=(*col(other),45))
  return
 pbox(d,(71,50,569,350),(19,31,58,245),(*col(accent),150),21,3)
 pbox(d,(87,64,553,106),(32,46,75,255),None,13,1)
 d.ellipse((104,77,118,91),fill=other)
 d.ellipse((127,77,141,91),fill=accent)
 for i in range(3):pbox(d,(270+77*i,78,336+77*i,92),(124,155,189,110),None,4,1)
 if is_dialog:
  pbox(d,(164,125,482,312),(28,45,73,248),(*col(other),230),18,3)
  pbox(d,(190,143,455,173),(*col(accent),170),None,8,1)
  for i in range(3):pbox(d,(205,198+i*24,433-i*18,207+i*24),(175,198,227,140),None,4,1)
  pbox(d,(273,268,376,294),accent,None,10,1)
  return
 pbox(d,(100,121,289,317),(32,54,83,220),(*col(other),125),14,2)
 d.ellipse((156,143,233,224),fill=(*col(other),130),outline="#ffe4bc",width=3)
 icon(d,192,180,25,rng.randint(0,4),accent)
 for i in range(4):
  pbox(d,(313,123+47*i,530,158+47*i),(33,49,78,255),(124,175,203,110),9,2)
  for k in range(3):
   icon(d,344+k*42,141+47*i,10,i+k,other if i%2 else accent)
 pbox(d,(151,277,242,290),accent,None,7,1)
def draw_effect(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 x,y=320,220
 for r in (52,92,132):
  d.arc((x-r,y-r,x+r,y+r),rng.randrange(10,60),rng.randrange(220,330),fill=other,width=5)
  d.arc((x-r-7,y-r-7,x+r+7,y+r+7),110,230,fill=accent,width=3)
 for i in range(10):
  ang=2*math.pi*i/10;x2=int(x+116*math.cos(ang));y2=int(y+116*math.sin(ang))
  draw_gem(d,x2,y2,11,other)
 poly(d,[(x,y-77),(x+61,y+42),(x,y+84),(x-62,y+42)],(*col(accent),185),"#f5f3ff",4)
 draw_gem(d,x,y,39,other)
 for i in range(20):
  spark(d,rng.randint(80,570),rng.randint(64,335),accent,rng.randint(3,8))
def draw_editor(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 for i,x in enumerate((48,350)):
  pbox(d,(x,85,x+242,330),(26,39,61,245),(*col(other if i else accent),160),18,3)
  pbox(d,(x+15,100,x+227,263),(35+24*i,56+22*i,81+22*i,255),None,12,1)
  d.ellipse((x+80,137,x+164,221),fill=(*col(other if i else accent),165))
  for t in range(3):
   pbox(d,(x+35,275+t*13,x+148+(t%2)*34,282+t*13),(208,222,238,160),None,3,1)
 poly(d,[(298,192),(319,192),(319,176),(346,207),(319,238),(319,220),(298,220)],other)
 spark(d,470,141,"#fff9d8",14)
def draw_moodboard(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 for i,(x,y,ww,hh) in enumerate(((48,73,184,200),(252,56,337,136),(253,216,337,112))):
  pbox(d,(x,y,x+ww,y+hh),(28+10*i,47+6*i,69+8*i,250),(210,218,223,75),15,2)
  d.ellipse((x+ww*.36,y+hh*.2,x+ww*.76,y+hh*.64),fill=(*col(other if i%2 else accent),125))
  poly(d,[(x+12,y+hh-20),(x+ww*.42,y+hh*.48),(x+ww*.69,y+hh*.77),(x+ww-8,y+hh*.36),(x+ww-8,y+hh-10)],(*col(accent),170))
 for i in range(5):
  x=52+i*46
  d.ellipse((x,319,x+27,346),fill=(*mix(col(accent),col(other),i/5),255),outline="#ffffff",width=1)
def draw_review(im,rng,accent,other,name):
 draw_ui(im,rng,accent,other,"面板")
 d=ImageDraw.Draw(im,"RGBA")
 d.ellipse((362,132,579,349),fill=(22,31,58,220),outline=other,width=10)
 line(d,[(534,321),(603,370)],other,21)
 d.ellipse((403,176,539,314),outline=accent,width=5)
 poly(d,[(437,245),(463,273),(513,214)],None)
 line(d,[(431,250),(458,278),(513,214)],"#b6ffd0",11)
def draw_ad(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 pbox(d,(178,38,460,368),(31,35,61,242),(242,204,172,190),31,6)
 pbox(d,(192,55,446,341),(43,53,94,255),None,23,1)
 d.ellipse((270,87,377,183),fill=(*col(other),110))
 draw_character(d,315,288,.73,accent,other,rng,2)
 pbox(d,(223,294,411,326),other,None,14,1)
 for i in range(3):spark(d,107+i*210,90+i*63,accent,9)
def draw_minigame(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 pbox(d,(126,39,515,366),(25,48,73,240),(*col(accent),150),24,4)
 pbox(d,(149,60,493,104),(54,86,109,245),None,10,1)
 for i in range(6):d.ellipse((165+50*i,73,179+50*i,88),fill=other)
 for row in range(4):
  for column in range(5):
   x=186+68*column;y=150+54*row
   pbox(d,(x-29,y-22,x+29,y+22),(45+column*4,68,94+row*5,220),(*col(other),100),7,1)
   icon(d,x,y,13,(column+row+rng.randrange(4))%6,accent if (column+row)%2 else other)
def draw_book(im,rng,accent,other,name):
 d=ImageDraw.Draw(im,"RGBA")
 poly(d,[(83,132),(314,91),(314,341),(74,362)],"#bba384","#ffe7b3",4)
 poly(d,[(314,91),(554,132),(565,362),(314,341)],"#d2b896","#ffe6bb",4)
 line(d,[(314,95),(314,342)],"#8b665a",6)
 for i in range(6):
  y=180+i*21
  line(d,[(124,y),(280-(i%3)*10,y-14)],"#987d75",3)
  line(d,[(347,y-14),(515-(i%2)*20,y+8)],"#977e73",3)
 d.ellipse((369,117,461,199),fill=(*col(accent),125))
 icon(d,420,167,24,3,other)
 spark(d,107,106,other,10)
def footer(im,title,accent):
 d=ImageDraw.Draw(im,"RGBA")
 d.rectangle((0,358,640,400),fill=(7,13,25,206))
 d.line((0,357,640,357),fill=(*col(accent),160),width=2)
 d.text((20,365),title[:24],fill="#f5f7ed",font=font(20))
 d.text((492,373),"HAMOKI ART",fill=(*col(accent),240),font=font(11))
def render(item):
 name=item["name"];cat=item["category"];id=item["id"]
 seed=int(hashlib.sha256(id.encode()).hexdigest()[:12],16)
 rng=random.Random(seed)
 a,b,c1,c2=COLORS.get(cat,COLORS["UI界面"])
 if seed%4==0:c1,c2=c2,c1
 im=Image.new("RGB",(W,H),a)
 grad(im,a,b)
 glow(im,(165+rng.randint(-50,140),150),190,c1,100)
 glow(im,(495+rng.randint(-80,45),280),180,c2,90)
 d=ImageDraw.Draw(im,"RGBA")
 for k in range(38):
  x=rng.randrange(W);y=rng.randrange(355)
  d.ellipse((x,y,x+rng.choice((1,2,3)),y+2),fill=(223,244,248,rng.randint(25,100)))
 for i in range(9):
  x=rng.randint(-70,650);y=rng.randint(30,320)
  line(d,[(x,y),(x+68,y-20)],(*col(c1),rng.randint(12,31)),2)
 if cat=="UI界面":draw_ui(im,rng,c1,c2,name)
 elif cat=="图标道具":
  if "棋盘" in name:draw_minigame(im,rng,c1,c2,name)
  else:draw_icon_sheet(im,rng,c1,c2,seed%6)
 elif cat=="角色生物":draw_people(im,rng,c1,c2,name)
 elif cat=="场景建筑":draw_landscape(im,rng,c1,c2,name)
 elif cat=="海报宣发":
  draw_landscape(im,rng,c1,c2,name)
  draw_character(ImageDraw.Draw(im,"RGBA"),275,356,1.12,c1,c2,rng,0)
  dd=ImageDraw.Draw(im,"RGBA");pbox(dd,(400,265,577,302),(*col(c2),208),None,14,1)
 elif cat=="特效材质":draw_effect(im,rng,c1,c2,name)
 elif cat=="图像处理":draw_editor(im,rng,c1,c2,name)
 elif cat=="灵感设定":draw_moodboard(im,rng,c1,c2,name)
 elif cat=="质检交付":draw_review(im,rng,c1,c2,name)
 elif cat=="买量":draw_ad(im,rng,c1,c2,name)
 elif cat=="小游戏":draw_minigame(im,rng,c1,c2,name)
 elif cat=="文游":draw_book(im,rng,c1,c2,name)
 else:draw_moodboard(im,rng,c1,c2,name)
 footer(im,name,c1)
 return im
def main():
 db=json.loads((ASSETS/"game-ui-tools.json").read_text(encoding="utf-8"))
 items=db["items"]
 max_items=int(sys.argv[1]) if len(sys.argv)>1 else len(items)
 for idx,item in enumerate(items[:max_items]):
  im=render(item)
  path=ASSETS/("ui-tool-art-"+item["id"]+".webp")
  im.save(path,"WEBP",quality=84,method=5)
  if idx<3:
   im.save(ASSETS/("_inspect-art-"+item["id"]+".png"),"PNG")
 print("rendered",min(max_items,len(items)),"of",len(items),"original illustrative covers")
 if max_items>=len(items):
  missing=[t["id"] for t in items if not (ASSETS/("ui-tool-art-"+t["id"]+".webp")).is_file()]
  assert not missing,missing
  print("total_bytes",sum((ASSETS/("ui-tool-art-"+t["id"]+".webp")).stat().st_size for t in items))
if __name__=="__main__":main()
