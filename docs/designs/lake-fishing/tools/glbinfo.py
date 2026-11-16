import json,struct,sys
b=open(sys.argv[1],'rb').read()
jl=struct.unpack_from('<I',b,12)[0]
js=json.loads(b[20:20+jl])
for i,n in enumerate(js['nodes']):
    print(i,n.get('name'),{k:v for k,v in n.items() if k in('translation','rotation','scale','children','mesh','skin')})
print('anims',[(a['name'],len(a['channels'])) for a in js.get('animations',[])])
print('mats',[m['name'] for m in js.get('materials',[])],'images',len(js.get('images',[])))
