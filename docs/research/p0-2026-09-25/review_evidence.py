"""Write the human-reviewed photo register and building/face evidence matrices."""
from pathlib import Path
import json,csv,html,re,hashlib
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer,CRS

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
RAW=ROOT/'.research/p0-2026-09-25/raw'
NOTES={
 'B1-a':'已目视：银行名称、26号门牌、门头山花、石材线脚和木门清楚。仅入口局部，不能证明整面开间或楼高。人物不应烘焙进立面。',
 'B1-b':'已目视：2021年的首层开间、窗栏、横向墙缝与上层柱廊局部；树干和行人遮挡，顶部未完整入镜。',
 'B1-c':'已目视：2012年同一临街立面；可辅助理解柱廊和开间连续性。仅历史结构参考，不能代替2021/2026现状。',
 'B1-d':'已目视：2016年斜向仰视的通高柱、弧形阳台、檐口。透视明显，有树遮挡，未显示背面；仅历史结构参考。',
 'B2-a':'已目视：2023年临街主立面及相邻转角侧面，拱窗、百叶、壁柱、阳台和基座可辨；屋顶与局部侧面被树冠遮挡。',
 'B2-b':'已目视：2012年门窗与柱式细部。与2023年照片的百叶/门窗颜色不同，只用于旧有几何参考，不混作同一时期材质。',
 'B3-a':'已目视：2026年主入口、钟塔、尖拱、圆窗及一侧长墙；局部屋面可见，另一侧与背面不能由此确认。',
 'B3-b':'已目视：2025年另一侧院落，教堂侧墙局部、邻楼及院内附属体量；遮挡严重，不能把画面里所有楼都归入教堂轮廓。',
 'R1':'已目视：街口斑马线、信号灯与邻近建筑可辨，车辆遮挡路面。元数据点在珠江西路附近；精确拍摄方位未标定，不作为华夏路路口量测图。',
 'R2':'已目视：主要为IFC和周边高楼，路面基本不可见。排除作为道路结构证据，仅保留检索反例。',
 'R3':'已目视：路牌明确指向华穗路南/北，存在掉头/左转、直行、右转导向；路缘及护柱可见。可佐证2024年该进口方向的交通组织，不能推算路宽，也不能当成2026现状确认。',
 'R4':'已目视：花城大道、华穗路等导向牌可辨。用于地点身份交叉核对；不能量测断面、车道数量或高程。',
}

photos=json.loads((OUT/'selected-photos.json').read_text())
for p in photos:
    p['review_status']='visually_reviewed'
    p['review_note']=NOTES[p['sample_id']]
    p['sha256']=hashlib.sha256((OUT/p['local_path']).read_bytes()).hexdigest()
(OUT/'selected-photos.json').write_text(json.dumps(photos,ensure_ascii=False,indent=2))

rows=json.loads((RAW/'commons-inventory.json').read_text()) if (RAW/'commons-inventory.json').exists() else []
extra=RAW/'commons-road-extra-images.json'
strip=lambda v:html.unescape(re.sub('<[^>]+>','',v or '')).strip()
if rows and extra.exists():
    for page in json.loads(extra.read_text())['query']['pages'].values():
        info=page['imageinfo'][0];meta=info['extmetadata'];get=lambda k:strip(meta.get(k,{}).get('value'))
        c=(page.get('coordinates')or[{}])[0]
        row={k:''for k in rows[0]}
        row.update(title=page['title'],categories='2024 in Huacheng Avenue, Guangzhou',page_url=info['descriptionurl'],
            image_url=info['url'],thumbnail_url=info['thumburl'],width=info['width'],height=info['height'],
            license=get('LicenseShortName'),license_url=get('LicenseUrl'),artist=get('Artist'),credit=get('Credit'),
            date=get('DateTimeOriginal'),description=get('ImageDescription'),camera_lat=c.get('lat'),camera_lon=c.get('lon'),
            attribution_required=get('AttributionRequired'),restrictions=get('Restrictions'))
        rows.append(row)
    rows=list({r['title']:r for r in rows}.values())
    with (OUT/'photo-inventory.csv').open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

md=['# P0 照片证据与逐张目视记录','',
    '日期：2026-09-25。共检索127张照片的元数据，以下12张已下载并目视核查。目录收录不等于照片可用于建模。',
    '本目录保存 Commons 提供的预览文件，未改图、未进行AI补全。原图和文件说明页见每张图片的链接。使用时保留署名、许可和原始来源；不把人物、车辆与阴影当作固定立面。','']
for p in photos:
    md += [f"## {p['sample_id']}",'',p['review_note'],'',
        f"![{p['sample_id']}]({p['local_path']})",'',
        f"来源：[{p['title']}]({p['page_url']})；作者：{p['artist']}；拍摄时间字段：{p['date']}；许可：[{p['license']}]({p['license_url']})。",'']
(OUT/'photo-review.md').write_text('\n'.join(md))

buildings=json.loads((OUT/'shamian-osm-buildings.geojson').read_text())['features']
byid={f['properties']['id']:f for f in buildings}
T=Transformer.from_crs('EPSG:4326',CRS.from_proj4('+proj=aeqd +lat_0=23.1185 +lon_0=113.296 +datum=WGS84 +units=m'),always_xy=True)
samples=[('B1','w352610322','台湾银行广州支行旧址','2021可见部位；2012/2016只作历史结构参考','B1-a | B1-b | B1-c | B1-d'),
 ('B2','w352610258','沙面一街3号（东方汇理银行旧址）','2023可见部位；2012只作历史结构参考','B2-a | B2-b'),
 ('B3','w392765468','露德圣母堂','2026主立面/一侧；2025另一侧院落局部','B3-a | B3-b')]
cards=[]
for sid,id,name,epoch,evidence in samples:
    f=byid[id];p=f['properties'];g=shape(f['geometry']);gm=transform(T.transform,g)
    cards.append(dict(sample_id=sid,osm_id=id,name=name,osm_name=p.get('name'),
        address=p.get('addr:street','')+p.get('addr:housenumber','')+'号',
        centroid_lon=round(g.centroid.x,7),centroid_lat=round(g.centroid.y,7),
        source_polygon_area_m2=round(gm.area,2),source_levels=p.get('building:levels',''),
        measured_height='',dimension_status='no independent measurements',reference_epoch=epoch,
        evidence=evidence,decision='可制作临街外观样件；四面完整与绝对精度不通过'))
def csvout(name,rows):
    with (OUT/name).open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
csvout('building-samples.csv',cards)

faces=[
 ('B1','临街主立面（南侧，结合OSM位置推定）','partial','B1-a | B1-b | B1-c | B1-d','入口/柱廊/部分开间','树遮挡；跨年份；顶部局部缺证'),
 ('B1','侧面A','unknown','','','未取得足够独立照片'),('B1','侧面B','unknown','','','未取得足够独立照片'),
 ('B1','背面','unknown','','','未取得照片'),('B1','屋顶','unknown','','','檐口局部不等于完整屋顶'),
 ('B2','临街主立面（东侧，结合OSM位置推定）','partial','B2-a | B2-b','楼层线/拱窗/壁柱/入口','树遮挡；旧照片色彩冲突'),
 ('B2','转角侧面（南侧，结合OSM位置推定）','partial','B2-a','局部开间与转角','侧面远端和顶部不可完整观察'),
 ('B2','另一侧面','unknown','','','无足够照片'),('B2','背面','unknown','','','无照片'),('B2','屋顶','unknown','','','树遮挡'),
 ('B3','主入口立面（南侧，结合OSM位置推定）','partial','B3-a','钟塔/尖拱/入口/圆窗','基座局部遮挡；没有高度标定'),
 ('B3','长侧墙（西侧，结合相机坐标与轮廓推定）','partial','B3-a','圆窗/尖拱窗/扶壁','局部树遮挡；需独立定标'),
 ('B3','院落侧墙（东侧，结合相机坐标推定）','partial','B3-b','侧窗和院落关系','植被/车遮挡；附属楼须另行归属'),
 ('B3','背面','unknown','','','无完整背面照片'),('B3','屋顶','partial','B3-a','坡向/局部屋面/装饰','未覆盖整个屋顶；无坡度量测'),
]
csvout('facade-evidence.csv',[dict(sample_id=a,face=b,coverage=c,photos=d,known=e,unknown=f,metric_accuracy='unverified')for a,b,c,d,e,f in faces])
print('Reviewed photos',len(photos),'building samples',len(cards),'face/roof records',len(faces))
